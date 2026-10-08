// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Durable rig filter lists (spec 072 PLAN-EQ-FR-01, PLAN-EQ-FR-06).
#![cfg(unix)]

mod support;

use persistence_library::Catalog;
use platevault_model::{
    AssociationState, Band, ColorKind, Equipment, LibraryError, Provenance, RigFilter, RigFilters,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::{kind, Fixture};
use uuid::Uuid;

async fn redcat(catalog: &Catalog) -> Equipment {
    let equipment = Equipment {
        id: Uuid::new_v4(),
        name: "RedCat".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(6248),
        sensor_height_px: Some(4176),
        color_kind: Some(ColorKind::Mono),
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    };
    catalog.save_equipment(&equipment, None).await.unwrap()
}

fn filter(id: Uuid, name: &str, values: &[&str], bands: &[Band]) -> RigFilter {
    RigFilter {
        id,
        name: name.into(),
        match_values: values.iter().map(|value| (*value).to_owned()).collect(),
        bands: bands.to_vec(),
    }
}

/// A fault armed on the catalog file itself: every filter row insert aborts
/// until it is disarmed, so the save fails after it removed the previous rows.
async fn fault(fx: &Fixture, armed: bool) {
    let options = SqliteConnectOptions::new().filename(&fx.db);
    let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
    let statement = if armed {
        "CREATE TRIGGER rig_filter_save_fault BEFORE INSERT ON rig_filters \
         BEGIN SELECT RAISE(ABORT, 'armed filter-list save fault'); END"
    } else {
        "DROP TRIGGER rig_filter_save_fault"
    };
    sqlx::query(statement).execute(&mut conn).await.unwrap();
    conn.close().await.unwrap();
}

fn assert_previous(read: &RigFilters, revision: u64, oiii_values: &[&str]) {
    assert_eq!(read.revision, revision);
    let names: Vec<&str> = read.filters.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["Ha", "OIII"]);
    assert_eq!(read.filters[1].match_values, oiii_values);
}

#[tokio::test]
async fn failed_filter_save_keeps_previous_list() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let rig = redcat(&catalog).await;
    let (ha, oiii) = (Uuid::new_v4(), Uuid::new_v4());
    let saved =
        [filter(ha, "Ha", &["Ha"], &[Band::Ha]), filter(oiii, "OIII", &["OIII"], &[Band::Oiii])];
    let first = catalog.save_rig_filters(rig.id, &saved, 0).await.unwrap();
    assert_previous(&first, 1, &["OIII"]);

    // The save fails inside its transaction: the edit is not durable and the
    // saved list (OIII matching `OIII` only) stays in effect.
    let edit = [
        filter(ha, "Ha", &["Ha"], &[Band::Ha]),
        filter(oiii, "OIII", &["OIII", "O3"], &[Band::Oiii]),
    ];
    fault(&fx, true).await;
    let failed = catalog.save_rig_filters(rig.id, &edit, 1).await.unwrap_err();
    assert_eq!(kind(&failed), "persistence_failure", "{failed:?}");
    assert_previous(&catalog.rig_filters(rig.id).await.unwrap(), 1, &["OIII"]);

    // Retry after the fault is disarmed saves the same edit.
    fault(&fx, false).await;
    let retried = catalog.save_rig_filters(rig.id, &edit, 1).await.unwrap();
    assert_previous(&retried, 2, &["OIII", "O3"]);

    // A stale or invalid save is refused before anything changes.
    let stale = catalog.save_rig_filters(rig.id, &saved, 1).await.unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { current: 2, .. }), "{stale:?}");
    let no_band = [filter(ha, "Ha", &["Ha"], &[])];
    let invalid = catalog.save_rig_filters(rig.id, &no_band, 2).await.unwrap_err();
    assert_eq!(kind(&invalid), "invalid_input");
    let ambiguous =
        [filter(ha, "Ha", &["Ha"], &[Band::Ha]), filter(oiii, "Ha again", &[" ha "], &[Band::Ha])];
    let invalid = catalog.save_rig_filters(rig.id, &ambiguous, 2).await.unwrap_err();
    assert_eq!(kind(&invalid), "invalid_input", "one FILTER value names one filter");
    assert_previous(&catalog.rig_filters(rig.id).await.unwrap(), 2, &["OIII", "O3"]);

    drop(catalog);
    let reopened = Catalog::open(&fx.db).await.unwrap();
    assert_previous(&reopened.rig_filters(rig.id).await.unwrap(), 2, &["OIII", "O3"]);
}
