// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library's workflow settings in the catalog (D-W114; 064 LIB-FR-04,
//! 065 PRJ-FR-31, 068 CAL-FR-15/20/21, J36 S8, 072 PLAN-FR-02): the defaults
//! at revision 0, a revision-checked save of non-defaults that reads back
//! whole, a stale save refused naming the settings, an invalid one refused
//! with nothing stored, and per-band Moon-avoidance curves kept per band.

use persistence_library::{Catalog, WORKFLOW_SETTINGS_ID};
use platevault_model::{
    Band, LibraryError, MoonAvoidanceCurve, Revision, ViewMode, WorkflowSettings,
};

async fn catalog() -> (tempfile::TempDir, Catalog) {
    let dir = tempfile::tempdir().unwrap();
    let catalog = Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap();
    (dir, catalog)
}

fn changed() -> WorkflowSettings {
    let mut settings = WorkflowSettings::default();
    settings.view_mode = ViewMode::Copies;
    settings.flats.window_nights = 3;
    settings.dark_bias.window_days = 180;
    settings.calibration.keep_raw_frames = true;
    settings.calibration.old_master_after_days = 30;
    settings
}

#[tokio::test]
async fn a_catalog_with_no_saved_settings_reads_the_defaults_at_revision_0() {
    let (_dir, catalog) = catalog().await;
    let (settings, revision) = catalog.workflow_settings().await.unwrap();
    assert_eq!(settings, WorkflowSettings::default());
    assert_eq!(revision, 0);
    assert!(!settings.calibration.keep_raw_frames, "J36 P1: raws are not kept by default");
    assert_eq!(settings.calibration.old_master_after_days, 90, "CAL-FR-15");
}

#[tokio::test]
async fn saved_settings_read_back_whole_at_the_next_revision() {
    let (dir, catalog) = catalog().await;
    let first = catalog.save_workflow_settings(0, &changed()).await.unwrap();
    assert_eq!(first, 1);
    assert_eq!(catalog.workflow_settings().await.unwrap(), (changed(), 1));

    let second = catalog.save_workflow_settings(first, &WorkflowSettings::default()).await;
    assert_eq!(second.unwrap(), 2, "saving the defaults again is a save");
    assert_eq!(catalog.workflow_settings().await.unwrap(), (WorkflowSettings::default(), 2));

    drop(catalog);
    let reopened = Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap();
    assert_eq!(reopened.workflow_settings().await.unwrap().1, 2, "durable across reopen");
}

#[tokio::test]
async fn a_stale_save_is_refused_naming_the_settings_at_their_revision() {
    let (_dir, catalog) = catalog().await;
    catalog.save_workflow_settings(0, &changed()).await.unwrap();
    for stale in [0, 2] {
        let refused = catalog.save_workflow_settings(stale, &WorkflowSettings::default()).await;
        match refused.unwrap_err() {
            LibraryError::Conflict { id, current, .. } => {
                assert_eq!((id, current), (WORKFLOW_SETTINGS_ID, 1), "expected {stale}");
            }
            other => panic!("expected a conflict, got {other:?}"),
        }
    }
    assert_eq!(catalog.workflow_settings().await.unwrap(), (changed(), 1), "nothing changed");
}

#[tokio::test]
async fn an_invalid_setting_is_refused_and_nothing_is_stored() {
    let (_dir, catalog) = catalog().await;
    let mut zero_days = changed();
    zero_days.calibration.old_master_after_days = 0;
    let mut far = changed();
    far.moon_avoidance.set(Band::Ha, MoonAvoidanceCurve { distance_deg: 200.0, width_days: 7.0 });
    let mut inverted = changed();
    inverted.flats.fine_within_deg = 9.0;
    for invalid in [zero_days, far, inverted] {
        let refused = catalog.save_workflow_settings(0, &invalid).await.unwrap_err();
        assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    }
    let revision: Revision = catalog.workflow_settings().await.unwrap().1;
    assert_eq!(revision, 0, "no refused save is recorded");
}

#[tokio::test]
async fn moon_avoidance_curves_are_saved_per_band() {
    let (_dir, catalog) = catalog().await;
    let mut settings = WorkflowSettings::default();
    let tight = MoonAvoidanceCurve { distance_deg: 25.0, width_days: 3.5 };
    let wide = MoonAvoidanceCurve { distance_deg: 150.0, width_days: 20.0 };
    settings.moon_avoidance.set(Band::Oiii, tight);
    settings.moon_avoidance.set(Band::L, wide);
    let revision = catalog.save_workflow_settings(0, &settings).await.unwrap();

    let (saved, at) = catalog.workflow_settings().await.unwrap();
    assert_eq!(at, revision);
    let curves = &saved.moon_avoidance;
    assert_eq!(curves.curve(Band::Oiii), tight);
    assert_eq!(curves.curve(Band::L), wide);
    let defaults = WorkflowSettings::default().moon_avoidance;
    for band in [Band::R, Band::G, Band::B, Band::Ha, Band::Sii] {
        assert_eq!(curves.curve(band), defaults.curve(band), "{band:?} keeps its default");
    }
}
