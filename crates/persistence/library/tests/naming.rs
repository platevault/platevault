// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Naming template overrides (STO-IMP-FR-07): the catalog stores one row per
//! overridden frame type and nothing for a type at its default.
#![cfg(unix)]

use persistence_library::Catalog;
use platevault_model::NamingFrameType;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row};

#[tokio::test]
async fn naming_override_rows_set_replace_and_clear() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("catalog.sqlite");
    let catalog = Catalog::open(&path).await.unwrap();
    assert!(catalog.naming_overrides().await.unwrap().is_empty());

    catalog.set_naming_override(NamingFrameType::MasterFlat, Some("m/{filter}/")).await.unwrap();
    catalog.set_naming_override(NamingFrameType::Light, Some("{target}/")).await.unwrap();
    catalog.set_naming_override(NamingFrameType::Light, Some("{target}/{date}/")).await.unwrap();
    assert_eq!(
        catalog.naming_overrides().await.unwrap(),
        [
            (NamingFrameType::Light, "{target}/{date}/".to_owned()),
            (NamingFrameType::MasterFlat, "m/{filter}/".to_owned()),
        ]
    );

    catalog.set_naming_override(NamingFrameType::Light, None).await.unwrap();
    assert_eq!(
        catalog.naming_overrides().await.unwrap(),
        [(NamingFrameType::MasterFlat, "m/{filter}/".to_owned())]
    );
    catalog.clear_naming_overrides().await.unwrap();
    assert!(catalog.naming_overrides().await.unwrap().is_empty());
    catalog.set_naming_override(NamingFrameType::Bias, Some("b/")).await.unwrap();
    catalog.close().await.unwrap();

    // The table holds only the override row, keyed by the stable type name, and
    // refuses a frame type outside the seven.
    let mut conn =
        sqlx::SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&path))
            .await
            .unwrap();
    let rows = sqlx::query("SELECT frame_type, template FROM naming_templates")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    let rows: Vec<(String, String)> =
        rows.iter().map(|row| (row.get("frame_type"), row.get("template"))).collect();
    assert_eq!(rows, [("bias".to_owned(), "b/".to_owned())]);
    let refused = sqlx::query(
        "INSERT INTO naming_templates (frame_type, template) VALUES ('snapshot', 'x/')",
    )
    .execute(&mut conn)
    .await;
    assert!(refused.is_err(), "an unknown frame type is refused");
}
