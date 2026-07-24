// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! DB byte-identity guard (spec 042 T254).
//!
//! `register_source` persists `SourceKind` / `ScanDepth` via their
//! `strum::IntoStaticStr` impls and reads them back via `EnumString`. T254
//! moved these enums from `contracts_core` to `domain_core`; the persisted
//! strings (`light_frames`, `calibration`, `project`, `inbox`, `recursive`,
//! `single`) MUST stay byte-identical (Local-First custody). This freezes the
//! stored-string contract end-to-end through the real `registered_sources`
//! table.

use domain_core::first_run::{OrganizationState, RegisterSourceRequest, ScanDepth, SourceKind};

use super::*;
use persistence_core::Database;

#[test]
fn source_kind_helper_strings_unchanged() {
    assert_eq!(source_kind_to_str(SourceKind::LightFrames), "light_frames");
    assert_eq!(source_kind_to_str(SourceKind::Calibration), "calibration");
    assert_eq!(source_kind_to_str(SourceKind::Project), "project");
    assert_eq!(source_kind_to_str(SourceKind::Inbox), "inbox");
}

#[test]
fn scan_depth_helper_strings_unchanged() {
    assert_eq!(scan_depth_to_str(ScanDepth::Recursive), "recursive");
    assert_eq!(scan_depth_to_str(ScanDepth::Single), "single");
}

/// Register a source and assert the raw persisted `kind` / `scan_depth`
/// column strings are the exact canonical values.
#[tokio::test]
async fn registered_source_columns_persist_canonical_strings() {
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    let pool = db.pool();

    let resp = register_source(
        pool,
        &RegisterSourceRequest {
            kind: SourceKind::Calibration,
            path: "/astro/cals".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Single,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .unwrap();

    let row: (String, String) =
        sqlx::query_as("SELECT kind, scan_depth FROM registered_sources WHERE id = ?")
            .bind(&resp.source_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(row.0, "calibration", "stored kind string changed");
    assert_eq!(row.1, "single", "stored scan_depth string changed");
}
